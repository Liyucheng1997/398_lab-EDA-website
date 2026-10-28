`timescale 1ns / 1ps

// 1) 读出全部 16 个初值并与期望比对；2) 读出 ASCII 字符串；3) 写入后回读；4) 验证读优先
module tb;
  logic       clk = 0, we = 0;
  logic [3:0] addr = 0;
  logic [7:0] din = 0, dout;
  integer     errors = 0;

  single_port_ram #(.ADDR_W(4), .DATA_W(8), .INIT_FILE("ram_init.hex")) dut (
    .clk(clk), .we(we), .addr(addr), .din(din), .dout(dout)
  );

  always #5 clk = ~clk;

  // 同步读：给地址，等一个上升沿后取数据
  task automatic read(input logic [3:0] a, output logic [7:0] d);
    @(negedge clk);
    addr = a;
    we   = 0;
    @(negedge clk);
    d = dout;
  endtask

  task automatic write(input logic [3:0] a, input logic [7:0] d);
    @(negedge clk);
    addr = a;
    din  = d;
    we   = 1;
    @(negedge clk);
    we = 0;
  endtask

  initial begin
    logic [7:0] d;
    string      text;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    // 1) 平方表
    for (integer i = 0; i < 8; i = i + 1) begin
      read(i[3:0], d);
      $display("mem[%0d] = %3d", i, d);
      if (d !== i * i) begin
        $display("  错误：期望 %0d", i * i);
        errors = errors + 1;
      end
    end

    // 2) 字符串
    text = "";
    for (integer i = 8; i < 16; i = i + 1) begin
      read(i[3:0], d);
      if (d != 0) text = {text, string'(d)};
    end
    $display("mem[8..15] 中的字符串：%s", text);
    if (text != "WebEDA!") errors = errors + 1;

    // 3) 写入后回读
    write(4'd3, 8'hC3);
    read(4'd3, d);
    if (d !== 8'hC3) begin $display("错误：写入后回读 %h", d); errors = errors + 1; end

    // 4) 读优先：同一拍写地址 5，dout 应为旧值 25(0x19)
    @(negedge clk);
    addr = 4'd5; din = 8'h55; we = 1;
    @(negedge clk);
    we = 0;
    if (dout !== 8'h19) begin $display("错误：读优先失败，dout = %h", dout); errors = errors + 1; end
    @(negedge clk);
    if (dout !== 8'h55) begin $display("错误：新值未写入，dout = %h", dout); errors = errors + 1; end

    if (errors == 0) $display("PASS: RAM 初值加载与读写全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
