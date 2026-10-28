`timescale 1ns / 1ps

// 测试平台内置一个 UART 接收模型：按位时间采样 tx，解码出字符串并与期望比对。
// 为了仿真快速，使用 CLK_HZ = 1600、BAUD = 100（每位 16 个时钟）。
module tb;
  localparam CLK_HZ = 1600, BAUD = 100;
  localparam BIT_NS = 10 * (CLK_HZ / BAUD);   // 时钟周期 10 ns

  logic clk = 0, btn_n = 1;
  logic tx, led_g_n;
  integer errors = 0;

  uart_hello #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) dut (.clk(clk), .btn_n(btn_n), .tx(tx), .led_g_n(led_g_n));

  always #5 clk = ~clk;

  // 接收一个字节（等待起始位下降沿，然后在每位中点采样）
  task automatic uart_receive(output logic [7:0] b);
    wait (tx === 1'b0);
    #(BIT_NS / 2);
    if (tx !== 1'b0) begin
      $display("错误：起始位不是 0");
      errors = errors + 1;
    end
    for (integer i = 0; i < 8; i = i + 1) begin
      #(BIT_NS);
      b[i] = tx;
    end
    #(BIT_NS);
    if (tx !== 1'b1) begin
      $display("错误：停止位不是 1");
      errors = errors + 1;
    end
  endtask

  task automatic receive_message(input integer n);
    logic [7:0]     b;
    logic [8*16-1:0] text;
    text = 0;
    for (integer i = 0; i < 16; i = i + 1) begin
      uart_receive(b);
      text = {text[8*15-1:0], b};
    end
    // 去掉末尾的 \r\n 再显示
    $display("[%0t] 第 %0d 条消息：\"%s\" + CR LF", $time, n, text[8*16-1:16]);
    if (text !== {"Hello, WebEDA!", 8'h0D, 8'h0A}) begin
      $display("  错误：内容不符");
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    receive_message(1);   // 上电后立即发送
    receive_message(2);   // 1 秒后再次发送

    // 空闲时按下按键，应立即再发送一次
    wait (led_g_n === 1'b1);
    repeat (20) @(negedge clk);
    btn_n = 0;
    repeat (5) @(negedge clk);
    btn_n = 1;
    fork
      receive_message(3); // 按键触发
      begin
        #(BIT_NS * 4);
        if (led_g_n !== 1'b0) begin
          $display("错误：发送期间绿灯应点亮");
          errors = errors + 1;
        end
      end
    join

    if (errors == 0) $display("PASS: 串口问候消息正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end

  // 超时保护
  initial begin
    #(BIT_NS * 10 * 16 * 6 + CLK_HZ * 10 * 3);
    $display("FAIL: 超时");
    $finish;
  end
endmodule
