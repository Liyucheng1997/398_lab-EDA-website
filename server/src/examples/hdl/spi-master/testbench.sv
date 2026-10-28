`timescale 1ns / 1ps

// 测试平台中的 SPI 从机模型：
//   在 SCLK 上升沿采样 MOSI，在下降沿移出 MISO；
//   每次传输回送「上一次收到的字节按位取反」，于是主机能同时校验 MOSI 与 MISO 两个方向。
module spi_slave_model (
  input  logic sclk,
  input  logic cs_n,
  input  logic mosi,
  output logic miso
);
  logic [7:0] rx_sh = 0, tx_sh = 8'h5A, last = 0;
  integer     bits = 0;

  assign miso = cs_n ? 1'bz : tx_sh[7];

  // 片选拉低：装载本次要回送的数据
  always @(negedge cs_n) begin
    tx_sh = ~last;
    bits  = 0;
  end
  always @(posedge sclk) if (!cs_n) begin
    rx_sh = {rx_sh[6:0], mosi};
    bits  = bits + 1;
  end
  always @(negedge sclk) if (!cs_n) tx_sh = {tx_sh[6:0], 1'b0};
  always @(posedge cs_n) if (bits == 8) last = rx_sh;
endmodule

module tb;
  logic       clk = 0, rst = 1, start = 0;
  logic [7:0] tx_data = 0, rx_data;
  logic       busy, done;
  logic       sclk, mosi, miso, cs_n;
  logic [7:0] prev = 0;
  integer     errors = 0, n = 0;

  spi_master #(.CLK_DIV(3)) dut (
    .clk(clk), .rst(rst), .start(start), .tx_data(tx_data), .rx_data(rx_data),
    .busy(busy), .done(done), .sclk(sclk), .mosi(mosi), .miso(miso), .cs_n(cs_n)
  );
  spi_slave_model slave (.sclk(sclk), .cs_n(cs_n), .mosi(mosi), .miso(miso));

  always #5 clk = ~clk;

  // 协议检查：片选无效时 SCLK 必须为低（模式 0）
  always @(posedge sclk)
    if (cs_n) begin
      $display("[%0t] 协议错误：cs_n 为高时出现 SCLK", $time);
      errors = errors + 1;
    end

  task automatic transfer(input logic [7:0] b);
    @(negedge clk);
    tx_data = b;
    start   = 1;
    @(negedge clk) start = 0;
    while (!done) @(negedge clk);
    n = n + 1;
    // 从机回送的是上一次主机发送字节的反码（第一次为 ~0 = FF）
    if (rx_data !== ~prev || slave.last !== b) begin
      $display("错误：发送 %h，主机收到 %h（期望 %h），从机收到 %h", b, rx_data, ~prev, slave.last);
      errors = errors + 1;
    end else if (n <= 4) begin
      $display("发送 %h -> 从机收到 %h，主机收到 %h", b, slave.last, rx_data);
    end
    prev = b;
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    transfer(8'hA5);
    transfer(8'h3C);
    transfer(8'h00);
    transfer(8'hFF);
    repeat (30) transfer($random);

    if (errors == 0) $display("PASS: %0d 次 SPI 传输双向数据全部正确", n);
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
